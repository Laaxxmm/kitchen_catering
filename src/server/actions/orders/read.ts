"use server";

/**
 * Reads. The lists every desk's board is built from, the status counts, and the one
 * order by id.
 */

import { ChefRequisitionStatus, OrderChannel, OrderStatus, Role } from "@prisma/client";
import { db } from "@/server/db";
import { hasRole, requireRole } from "@/server/rbac";
import type { DateWindow } from "@/lib/time";

// Every role the middleware lets onto /orders must be listed here, or the
// page's listOrders call throws and the whole route crashes for that role.
const READ_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.SALES, Role.STORE_KEEPER, Role.KITCHEN_HEAD, Role.ACCOUNTS,
  Role.DELIVERY, Role.FNB_SERVICE,
];

// =====================================================================
// QUERIES
// =====================================================================

export interface OrderFilter {
  status?: OrderStatus | OrderStatus[];
  customerId?: string;
  myQueue?: boolean;
  query?: string;
  /** Optional half-open eventDate window — resolve IST day boundaries with
   *  the helpers in @/lib/time (istScopeWindow etc.) before passing. */
  eventFrom?: Date;
  eventToExclusive?: Date;
}

/** Count of orders per status across the whole table — drives the orders-page
 *  tab counts so they're accurate regardless of the active filter. */
export async function getOrderStatusCounts(): Promise<Partial<Record<OrderStatus, number>>> {
  const session = await requireRole(READ_ROLES);
  // F&B Service only sees in-house room orders — scope their tab counts to match.
  const fnbScoped =
    session.user.role === Role.DELIVERY || session.user.role === Role.FNB_SERVICE;
  const rows = await db.order.groupBy({
    by: ["status"],
    _count: { _all: true },
    ...(fnbScoped
      ? { where: { channel: { in: [OrderChannel.ROOM_SERVICE, OrderChannel.ALACARTE, OrderChannel.MANAGEMENT] } } }
      : {}),
  });
  const out: Partial<Record<OrderStatus, number>> = {};
  for (const r of rows) out[r.status] = r._count._all;
  return out;
}

export async function listOrders(filter: OrderFilter = {}) {
  const session = await requireRole(READ_ROLES);

  // "My queue" maps to role-relevant statuses (workflow v2: chef-first).
  let statuses: OrderStatus[] | undefined;
  if (filter.myQueue) {
    if (hasRole(session, [Role.STORE_KEEPER])) {
      // Store no longer approves orders; their queue is the requisition
      // fulfilment list (/queue/issuing). Surface ISSUING orders here so
      // they can see what's in flight.
      statuses = [OrderStatus.ISSUING];
    } else if (hasRole(session, [Role.MANAGER])) {
      // Manager owns proposed-changes approval + everything in flight.
      statuses = [OrderStatus.CHANGES_PROPOSED_BY_CHEF];
    } else if (hasRole(session, [Role.KITCHEN_HEAD])) {
      // Chef's queue: orders waiting for chef-approval first, then
      // production work afterwards.
      statuses = [
        OrderStatus.PENDING_CHEF_APPROVAL,
        OrderStatus.CHEF_REQUISITION_PENDING,
        OrderStatus.ISSUING,
        OrderStatus.READY_FOR_PRODUCTION,
        OrderStatus.IN_PREP,
        OrderStatus.READY,
      ];
    } else if (hasRole(session, [Role.SALES])) {
      statuses = [OrderStatus.DRAFT, OrderStatus.PENDING_CHEF_APPROVAL, OrderStatus.CHANGES_PROPOSED_BY_CHEF];
    } else if (hasRole(session, [Role.DELIVERY])) {
      statuses = [OrderStatus.READY, OrderStatus.OUT_FOR_DELIVERY];
    }
  } else if (filter.status) {
    statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
  }

  // F&B Service (role DELIVERY, FNB_SERVICE its retired alias) only handles
  // in-house room orders — they see just those, not the whole catering book.
  const fnbScoped =
    session.user.role === Role.DELIVERY || session.user.role === Role.FNB_SERVICE;

  return db.order.findMany({
    where: {
      ...(statuses ? { status: { in: statuses } } : {}),
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
      ...(filter.eventFrom || filter.eventToExclusive
        ? {
            eventDate: {
              ...(filter.eventFrom ? { gte: filter.eventFrom } : {}),
              ...(filter.eventToExclusive ? { lt: filter.eventToExclusive } : {}),
            },
          }
        : {}),
      ...(fnbScoped
        ? { channel: { in: [OrderChannel.ROOM_SERVICE, OrderChannel.ALACARTE, OrderChannel.MANAGEMENT] } }
        : {}),
      ...(filter.query
        ? {
            OR: [
              { code: { contains: filter.query, mode: "insensitive" } },
              { customer: { name: { contains: filter.query, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: { customer: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

/**
 * Confirmed catering orders the store still needs to stock for — chef has
 * accepted the order (CHEF_APPROVED) through to cooked (READY), before it's
 * dispatched. Excludes DRAFT / pending-approval (not yet confirmed) and
 * OUT_FOR_DELIVERY onward + terminal states (nothing left to stock). Single
 * source for the "confirmed but not yet delivered" window the store plans
 * against.
 */
const STORE_UPCOMING_STATUSES: OrderStatus[] = [
  OrderStatus.CHEF_APPROVED,
  OrderStatus.CHEF_REQUISITION_PENDING,
  OrderStatus.ISSUING,
  OrderStatus.READY_FOR_PRODUCTION,
  OrderStatus.IN_PREP,
  OrderStatus.READY,
];

/**
 * #5: read-only forward view for the store keeper — every confirmed order
 * (see STORE_UPCOMING_STATUSES) whose event falls in the optional half-open
 * eventDate `window` (resolve with istScopeWindow; omit for the whole forward
 * book), nearest event first, so the store can pre-arrange stock.
 * `requisitionRaised` flags whether the chef has already put the order into
 * the store's requisition queue — what's actionable now vs. still coming.
 * Gated on READ_ROLES (STORE_KEEPER included), mirroring listOrders.
 */
export async function listUpcomingOrdersForStore(window?: DateWindow) {
  await requireRole(READ_ROLES);
  const rows = await db.order.findMany({
    where: {
      status: { in: STORE_UPCOMING_STATUSES },
      ...(window ? { eventDate: { gte: window.from, lt: window.toExclusive } } : {}),
    },
    select: {
      id: true,
      code: true,
      channel: true,
      status: true,
      headcount: true,
      eventDate: true,
      customer: { select: { name: true } },
      // A live (non-cancelled) requisition means it's already in the store's
      // queue — one is enough to answer the boolean.
      chefRequisitions: {
        where: { status: { not: ChefRequisitionStatus.CANCELLED } },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: { eventDate: "asc" },
    take: 100,
  });
  return rows.map((o) => ({
    id: o.id,
    code: o.code,
    channel: o.channel,
    status: o.status,
    headcount: o.headcount,
    eventDate: o.eventDate.toISOString(),
    customerName: o.customer.name,
    requisitionRaised: o.chefRequisitions.length > 0,
  }));
}

/**
 * One order, in full. Gated on the same READ_ROLES as {@link listOrders} —
 * signed-in was not enough: the housekeeping and maintenance managers are
 * kept off every /orders route by the middleware, yet could read any order
 * by id straight through this action.
 *
 * Not scoped by channel the way listOrders is, deliberately. That scope
 * hides non-in-house orders from F&B/delivery, but their own board is fed by
 * listEventPrepQueue + listUpcomingEventOrders (both DELIVERY-gated, both
 * event-channel only) and every card there links here — and the two channel
 * sets in lib/order-channels.ts together cover the whole enum, so the rule
 * would blank a working screen and scope out nothing.
 */
export async function getOrder(id: string) {
  await requireRole(READ_ROLES);
  return db.order.findUnique({
    where: { id },
    include: {
      customer: true,
      items: { include: { dish: { select: { name: true, code: true, unit: true } } }, orderBy: { sortOrder: "asc" } },
      createdBy: { select: { name: true, email: true } },
      storeReviewedBy: { select: { name: true } },
      managerReviewedBy: { select: { name: true } },
      chefReviewedBy: { select: { name: true } },
      managerChangeReviewedBy: { select: { name: true } },
      kitchenSupervisor: { select: { name: true } },
      feedbackAssignee: { select: { name: true } },
      chefRequisitions: { select: { id: true, requisitionNo: true, status: true } },
      orderRevisions: {
        include: { revisedBy: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
      // Named serving staff the F&B team allocated to run the event —
      // rendered as chips in the "Serving staff" section.
      staffAllocations: {
        select: { id: true, staffName: true, duty: true },
        orderBy: { createdAt: "asc" },
      },
      // Leftovers returned from a counter-sale / ODC event — rendered as
      // chips in the "Leftovers returned" section (that channel only).
      leftoverReturns: {
        select: { id: true, itemName: true, quantity: true, unit: true, disposition: true, note: true },
        orderBy: { createdAt: "asc" },
      },
      // Per-dish kitchen → delivery handover state (an order has at most
      // one production job). Lean select: only what the handover checklist
      // + accountability timeline need.
      productionJobs: {
        select: {
          id: true,
          items: {
            select: {
              id: true,
              status: true,
              portions: true,
              handedOverAt: true,
              dish: { select: { name: true } },
              handedOverBy: { select: { name: true } },
            },
          },
        },
        take: 1,
      },
    },
  });
}
