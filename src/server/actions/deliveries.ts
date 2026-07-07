"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { DeliveryStatus, OrderChannel, OrderStatus, PaymentMethod, Role } from "@prisma/client";
import { Decimal } from "decimal.js";
import { db } from "@/server/db";
import { toDecimal } from "@/lib/money";
import { requireRole, requireSession } from "@/server/rbac";
import {
  ActionError,
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";
import { deferAfterResponse } from "@/server/defer";
import {
  DeliveryAssignInput,
  DeliveryFailureInput,
  DeliveryOTPInput,
} from "@/lib/validators";
import { nextDeliveryNumber } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { istToUtc } from "@/lib/time";
import { channelWantsFeedback, isEventDeliveryChannel } from "@/lib/order-channels";
import { notifyRoles } from "@/server/actions/notifications";

// Off-site catering orders (banquet / ODC / packed) move through these
// statuses once they're confirmed and in the kitchen, up to the moment
// they're dispatched. The delivery team prepares cutlery + arrangements
// across this whole window — so this is the set the prep queue watches.
const EVENT_PREP_STATUSES: OrderStatus[] = [
  OrderStatus.CHEF_REQUISITION_PENDING,
  OrderStatus.ISSUING,
  OrderStatus.READY_FOR_PRODUCTION,
  OrderStatus.IN_PREP,
  OrderStatus.READY,
  OrderStatus.OUT_FOR_DELIVERY,
];

/**
 * 24-byte random token, base64url-encoded — used for the public
 * feedback link minted on delivery completion. Same shape as the
 * existing CustomerInvoice.shareToken.
 */
function randomFeedbackToken(): string {
  return randomBytes(24).toString("base64url");
}

const SCHEDULE_ROLES = [Role.ADMIN, Role.MANAGER];
const DRIVER_OR_MANAGER = [Role.ADMIN, Role.MANAGER, Role.DELIVERY];
const READ_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.SALES, Role.STORE_KEEPER, Role.KITCHEN_HEAD, Role.ACCOUNTS, Role.DELIVERY,
];

/**
 * Schedule a delivery against a READY order. The OTP step has been
 * dropped — the driver confirms delivery directly from the mobile app
 * when they hand the goods over. Tax invoice is auto-generated the
 * moment delivery is confirmed (see `confirmDeliveryOTP`).
 *
 * The legacy `otpHash` / `otpAttempts` columns remain on the schema
 * (cheap, harmless) so confirm-side code that branches on their absence
 * doesn't break for in-flight deliveries.
 */
/**
 * Chef hand-off. When the food is cooked (order READY) the kitchen taps
 * "Hand to delivery" from their dashboard. This does NOT schedule a driver
 * — picking a driver / vehicle / time is the dispatch desk's job (admin /
 * manager) and the chef has no business with the driver roster. It simply
 * pings the delivery + manager team that the order is ready for pickup,
 * with a link straight to the scheduling screen. Keeps the chef's UI
 * simple and avoids the permission error from sending them to /deliveries/new.
 */
export async function handToDelivery(orderId: string): Promise<ActionResult> {
  try {
    return await handToDeliveryInner(orderId);
  } catch (err) {
    return actionFailure(err);
  }
}

async function handToDeliveryInner(orderId: string): Promise<{ ok: true }> {
  const session = await requireRole([Role.ADMIN, Role.MANAGER, Role.KITCHEN_HEAD]);
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      code: true,
      status: true,
      channel: true,
      roomNumber: true,
      customer: { select: { name: true } },
    },
  });
  if (!order) throw new ActionError("Order not found");
  // Already handed off / scheduled / delivered — treat as a harmless no-op
  // so a stale board card (or a double-tap) doesn't surface an error.
  const ALREADY_DISPATCHED: OrderStatus[] = [
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.DELIVERED,
    OrderStatus.INVOICED,
    OrderStatus.PAID,
    OrderStatus.COMPLETED,
  ];
  if (ALREADY_DISPATCHED.includes(order.status)) {
    revalidatePath("/kitchen");
    return { ok: true };
  }
  if (order.status !== OrderStatus.READY) {
    // Still cooking — genuinely not ready.
    throw new ActionError(
      `Order ${order.code} isn't ready to dispatch yet (it's ${order.status}).`,
    );
  }
  // Stamp the intimation so the kitchen card flips to "Delivery informed".
  // Status guard in the WHERE: if the order moved on since the read (a
  // concurrent dispatch/cancel), skip the stamp — same no-op as above.
  const updated = await db.order.updateMany({
    where: { id: orderId, status: OrderStatus.READY },
    data: { handedToDeliveryAt: new Date() },
  });
  if (updated.count === 0) {
    revalidatePath("/kitchen");
    return { ok: true };
  }
  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "ORDER_HANDED_TO_DELIVERY",
      entity: "Order",
      entityId: orderId,
    },
  });
  const where = order.roomNumber ? ` · Room ${order.roomNumber}` : "";
  // Fan-out is best-effort — the chef's button shouldn't wait on it.
  deferAfterResponse("hand-to-delivery:notify", () =>
    notifyRoles([Role.DELIVERY, Role.ADMIN, Role.MANAGER], {
      kind: "GENERIC",
      title: `Order ${order.code} ready to dispatch`,
      body: `${order.customer.name} · ${order.channel}${where}. Cooked and ready — schedule the delivery.`,
      link: `/deliveries/new?orderId=${orderId}`,
      dedupeKey: `order-ready-dispatch:${orderId}`,
    }),
  );
  revalidatePath("/dashboard");
  revalidatePath("/kitchen");
  revalidatePath("/deliveries");
  return { ok: true };
}

/**
 * Confirmed off-site catering orders (banquet / ODC / packed) the delivery
 * team has to prep cutlery + arrangements for. Spans the whole confirmed →
 * dispatched window so they can ready things well ahead of the event; each
 * row carries whether prep is already marked ready and by whom. Soonest
 * events first. Powers the driver work-screen's "Event prep" tab.
 */
export async function listEventPrepQueue() {
  await requireRole([Role.ADMIN, Role.MANAGER, Role.DELIVERY]);
  const rows = await db.order.findMany({
    where: {
      channel: { in: [OrderChannel.BANQUET, OrderChannel.ODC, OrderChannel.PACKET] },
      status: { in: EVENT_PREP_STATUSES },
    },
    select: {
      id: true,
      code: true,
      channel: true,
      headcount: true,
      eventDate: true,
      deliveryAddress: true,
      eventPrepReadyAt: true,
      eventPrepReadyBy: { select: { name: true } },
      customer: { select: { name: true } },
    },
    orderBy: { eventDate: "asc" },
    take: 100,
  });
  return rows.map((o) => ({
    id: o.id,
    code: o.code,
    channel: o.channel,
    headcount: o.headcount,
    eventDate: o.eventDate.toISOString(),
    deliveryAddress: o.deliveryAddress,
    customerName: o.customer.name,
    prepReadyAt: o.eventPrepReadyAt ? o.eventPrepReadyAt.toISOString() : null,
    prepReadyBy: o.eventPrepReadyBy?.name ?? null,
  }));
}

/**
 * The delivery team taps "Mark event prep ready" once the cutlery, crockery
 * and event arrangements for an off-site catering order are packed and ready.
 * Tracked on the order (eventPrepReadyAt + who), audit-logged, and chimed to
 * the kitchen + management so everyone knows the front-of-house side is set.
 * Idempotent: a second tap (or a stale card) is a harmless no-op.
 */
export async function markEventPrepReady(orderId: string): Promise<ActionResult> {
  try {
    return await markEventPrepReadyInner(orderId);
  } catch (err) {
    return actionFailure(err);
  }
}

async function markEventPrepReadyInner(orderId: string): Promise<{ ok: true }> {
  const session = await requireRole([Role.ADMIN, Role.MANAGER, Role.DELIVERY]);
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      code: true,
      channel: true,
      eventPrepReadyAt: true,
      customer: { select: { name: true } },
    },
  });
  if (!order) throw new ActionError("Order not found");
  if (!isEventDeliveryChannel(order.channel)) {
    throw new ActionError(
      `Event prep only applies to off-site catering (banquet / ODC / packed) — order ${order.code} is ${order.channel}.`,
    );
  }
  // Already marked ready — no-op so a double-tap doesn't error.
  if (order.eventPrepReadyAt) {
    revalidatePath("/dashboard");
    return { ok: true };
  }
  // Guarded write: a concurrent tap that already stamped it simply
  // matches zero rows — same harmless no-op.
  const updated = await db.order.updateMany({
    where: { id: orderId, eventPrepReadyAt: null },
    data: { eventPrepReadyAt: new Date(), eventPrepReadyById: session.user.id },
  });
  if (updated.count === 0) {
    revalidatePath("/dashboard");
    return { ok: true };
  }
  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "ORDER_EVENT_PREP_READY",
      entity: "Order",
      entityId: orderId,
    },
  });
  // Chime is best-effort — don't hold the response for the fan-out.
  deferAfterResponse("event-prep-ready:notify", () =>
    notifyRoles([Role.KITCHEN_HEAD, Role.ADMIN, Role.MANAGER], {
      kind: "GENERIC",
      title: `Event prep ready — ${order.code}`,
      body: `${order.customer.name} · ${order.channel}. Cutlery + arrangements packed and ready by the delivery team.`,
      link: `/orders/${orderId}`,
      dedupeKey: `event-prep-ready:${orderId}`,
    }),
  );
  revalidatePath("/dashboard");
  revalidatePath("/deliveries");
  revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}

/**
 * Orders the kitchen has cooked and handed off (status READY) that don't
 * yet have an active delivery — i.e. waiting for a driver to pick them up.
 * Powers the "Ready for pickup" panel on the driver dashboard.
 */
export async function listReadyForDispatch() {
  await requireRole([Role.ADMIN, Role.MANAGER, Role.DELIVERY]);
  return db.order.findMany({
    where: {
      status: OrderStatus.READY,
      deliveries: {
        none: { status: { notIn: [DeliveryStatus.FAILED, DeliveryStatus.CANCELLED] } },
      },
    },
    select: {
      id: true,
      code: true,
      channel: true,
      headcount: true,
      eventDate: true,
      roomNumber: true,
      deliveryAddress: true,
      customer: { select: { name: true } },
      items: {
        orderBy: { sortOrder: "asc" },
        select: { portions: true, dish: { select: { name: true } } },
      },
    },
    orderBy: { eventDate: "asc" },
    take: 50,
  });
}

/**
 * Load one event's context for the cutlery-prep page (the F&B team picks the
 * items, issues what's in stock, requests the rest, then marks ready).
 */
export async function getEventPrepOrder(orderId: string) {
  await requireRole([Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY]);
  const o = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      code: true,
      channel: true,
      headcount: true,
      eventDate: true,
      deliveryAddress: true,
      eventPrepReadyAt: true,
      eventPrepReadyBy: { select: { name: true } },
      customer: { select: { name: true } },
    },
  });
  if (!o) return null;
  return {
    id: o.id,
    code: o.code,
    channel: o.channel,
    headcount: o.headcount,
    eventDate: o.eventDate.toISOString(),
    deliveryAddress: o.deliveryAddress,
    customerName: o.customer.name,
    prepReadyAt: o.eventPrepReadyAt ? o.eventPrepReadyAt.toISOString() : null,
    prepReadyBy: o.eventPrepReadyBy?.name ?? null,
  };
}

/**
 * The driver's active deliveries (SCHEDULED / DISPATCHED / IN_TRANSIT),
 * with the order context the dashboard board needs. Drivers see only their
 * own; admin/manager see all. Powers the tabbed driver work-screen.
 */
export async function listMyActiveDeliveries() {
  const session = await requireRole([Role.ADMIN, Role.MANAGER, Role.DELIVERY]);
  return db.delivery.findMany({
    where: {
      ...(session.user.role === Role.DELIVERY ? { driverUserId: session.user.id } : {}),
      status: {
        in: [DeliveryStatus.SCHEDULED, DeliveryStatus.DISPATCHED, DeliveryStatus.IN_TRANSIT],
      },
    },
    select: {
      id: true,
      deliveryNo: true,
      status: true,
      scheduledAt: true,
      order: {
        select: {
          code: true,
          channel: true,
          headcount: true,
          roomNumber: true,
          eventDate: true,
          deliveryAddress: true,
          customer: { select: { name: true } },
          items: {
            orderBy: { sortOrder: "asc" },
            select: { portions: true, dish: { select: { name: true } } },
          },
        },
      },
    },
    orderBy: { scheduledAt: "asc" },
    take: 100,
  });
}

/**
 * Driver self-pickup. Instead of waiting for a manager to schedule + assign
 * a driver, the driver taps "Take delivery" on a cooked order from their
 * dashboard — this creates a delivery assigned to them (status SCHEDULED),
 * which then drives the normal dispatch → confirm flow. Keeps small-team
 * delivery friction-free; managers can still schedule + assign explicitly
 * via /deliveries/new when they want to direct a specific driver.
 */
export async function claimDelivery(
  orderId: string,
): Promise<ActionResultWith<{ id: string; deliveryNo: string }>> {
  try {
    return await claimDeliveryInner(orderId);
  } catch (err) {
    return actionFailure(err);
  }
}

async function claimDeliveryInner(
  orderId: string,
): Promise<{ ok: true; id: string; deliveryNo: string }> {
  const session = await requireRole([Role.ADMIN, Role.MANAGER, Role.DELIVERY]);
  const created = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        code: true,
        status: true,
        customer: { select: { contactName: true, phone: true } },
      },
    });
    if (!order) throw new ActionError("Order not found");
    if (order.status !== OrderStatus.READY) {
      throw new ActionError(
        `Order ${order.code} isn't ready for pickup yet (it's ${order.status}).`,
      );
    }
    const existing = await tx.delivery.findFirst({
      where: { orderId, status: { notIn: [DeliveryStatus.FAILED, DeliveryStatus.CANCELLED] } },
      select: { id: true },
    });
    if (existing) throw new ActionError("This order has already been picked up.");

    const deliveryNo = await nextDeliveryNumber(tx);
    const delivery = await tx.delivery.create({
      data: {
        deliveryNo,
        orderId,
        driverUserId: session.user.id,
        scheduledAt: new Date(),
        recipientName: order.customer.contactName ?? null,
        recipientPhone: order.customer.phone ?? null,
        status: DeliveryStatus.SCHEDULED,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DELIVERY_SELF_ASSIGNED",
        entity: "Delivery",
        entityId: delivery.id,
        payloadHash: sha256Json({ orderId }),
      },
    });
    return delivery;
  });

  revalidatePath("/dashboard");
  revalidatePath("/deliveries");
  return { ok: true, id: created.id, deliveryNo: created.deliveryNo };
}

export async function scheduleDelivery(
  raw: unknown,
): Promise<ActionResultWith<{ id: string; deliveryNo: string }>> {
  try {
    return await scheduleDeliveryInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function scheduleDeliveryInner(
  raw: unknown,
): Promise<{ ok: true; id: string; deliveryNo: string }> {
  const session = await requireRole(SCHEDULE_ROLES);
  const input = DeliveryAssignInput.parse(raw);

  const result = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: { id: true, code: true, status: true, deliveryAddress: true, customer: { select: { contactName: true, phone: true } } },
    });
    if (!order) throw new ActionError("Order not found");
    if (order.status !== OrderStatus.READY) {
      throw new ActionError(`Cannot schedule delivery for order in status ${order.status}`);
    }

    const deliveryNo = await nextDeliveryNumber(tx);

    const delivery = await tx.delivery.create({
      data: {
        deliveryNo,
        orderId: order.id,
        driverUserId: input.driverUserId,
        vehicleNo: input.vehicleNo ?? null,
        // datetime-local sends IST clock time — convert to a UTC instant.
        scheduledAt: istToUtc(input.scheduledAt),
        // otpHash deliberately left null — OTP step retired.
        recipientName: order.customer.contactName ?? null,
        recipientPhone: order.customer.phone ?? null,
        status: DeliveryStatus.SCHEDULED,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DELIVERY_SCHEDULED",
        entity: "Delivery",
        entityId: delivery.id,
        payloadHash: sha256Json({ orderId: order.id, driverUserId: input.driverUserId }),
      },
    });

    return { delivery };
  });

  revalidatePath("/deliveries");
  revalidatePath(`/orders/${input.orderId}`);
  return { ok: true, id: result.delivery.id, deliveryNo: result.delivery.deliveryNo };
}

export async function dispatchDelivery(id: string): Promise<ActionResult> {
  try {
    const session = await requireRole(DRIVER_OR_MANAGER);
    await db.$transaction(async (tx) => {
      const delivery = await tx.delivery.findUnique({
        where: { id },
        select: { status: true, driverUserId: true, orderId: true },
      });
      if (!delivery) throw new ActionError("Delivery not found");
      if (delivery.status !== DeliveryStatus.SCHEDULED) {
        throw new ActionError(`Cannot dispatch a delivery in status ${delivery.status}`);
      }
      // Driver can only dispatch their own.
      if (
        session.user.role === Role.DELIVERY &&
        delivery.driverUserId !== session.user.id
      ) {
        throw new ActionError("Drivers can only dispatch their own deliveries");
      }
      // Status guard: two dispatch taps (or two devices) can't both
      // transition the delivery — the loser gets a clear message.
      const updated = await tx.delivery.updateMany({
        where: { id, status: DeliveryStatus.SCHEDULED },
        data: { status: DeliveryStatus.DISPATCHED, dispatchedAt: new Date() },
      });
      if (updated.count === 0) {
        throw new ActionError("This delivery was already dispatched — refresh the page.");
      }
      await tx.order.update({
        where: { id: delivery.orderId },
        data: { status: OrderStatus.OUT_FOR_DELIVERY },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "DELIVERY_DISPATCHED",
          entity: "Delivery",
          entityId: id,
        },
      });
    });
    revalidatePath(`/deliveries/${id}`);
    revalidatePath("/deliveries");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function markDeliveryArrived(id: string): Promise<ActionResult> {
  try {
    const session = await requireRole(DRIVER_OR_MANAGER);
    await db.$transaction(async (tx) => {
      const delivery = await tx.delivery.findUnique({
        where: { id },
        select: { status: true, driverUserId: true },
      });
      if (!delivery) throw new ActionError("Delivery not found");
      if (
        delivery.status !== DeliveryStatus.DISPATCHED &&
        delivery.status !== DeliveryStatus.IN_TRANSIT
      ) {
        throw new ActionError(`Cannot mark arrived from ${delivery.status}`);
      }
      if (session.user.role === Role.DELIVERY && delivery.driverUserId !== session.user.id) {
        throw new ActionError("Drivers can only update their own deliveries");
      }
      // Status guard: skip the stamp if the delivery moved on meanwhile.
      const updated = await tx.delivery.updateMany({
        where: { id, status: { in: [DeliveryStatus.DISPATCHED, DeliveryStatus.IN_TRANSIT] } },
        data: { arrivedAt: new Date() },
      });
      if (updated.count === 0) {
        throw new ActionError("Delivery status just changed — refresh the page.");
      }
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "DELIVERY_ARRIVED",
          entity: "Delivery",
          entityId: id,
        },
      });
    });
    revalidatePath(`/deliveries/${id}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * Confirm a delivery (the driver clicks "Delivered" at the customer's
 * door). No OTP needed — the customer-readback step has been retired.
 *
 * In one transaction:
 *   1. Mark the delivery DELIVERED + record the timestamp.
 *   2. Optionally capture payment-on-delivery (amount + method + ref).
 *   3. Auto-create + issue the GST tax invoice for the order.
 *   4. Advance the order DELIVERED → INVOICED.
 *   5. If payment was collected, record it against the freshly-created
 *      invoice (so the line ties out 3-way: delivery ↔ invoice ↔ payment).
 *
 * The function name still ends `…OTP` to keep the existing route shims
 * working without a rename sweep; the OTP field on the input is now
 * optional and ignored if absent.
 */
export async function confirmDeliveryOTP(id: string, raw: unknown): Promise<ActionResult> {
  try {
    return await confirmDeliveryOTPInner(id, raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function confirmDeliveryOTPInner(id: string, raw: unknown): Promise<{ ok: true }> {
  const session = await requireRole(DRIVER_OR_MANAGER);
  const input = DeliveryOTPInput.parse(raw);

  const result = await db.$transaction(async (tx) => {
    const delivery = await tx.delivery.findUnique({ where: { id } });
    if (!delivery) throw new ActionError("Delivery not found");
    if (delivery.status === DeliveryStatus.DELIVERED || delivery.status === DeliveryStatus.FAILED) {
      throw new ActionError(`Delivery is already ${delivery.status}`);
    }
    if (session.user.role === Role.DELIVERY && delivery.driverUserId !== session.user.id) {
      throw new ActionError("Drivers can only confirm their own deliveries");
    }

    // Legacy OTP support: if the delivery row has an otpHash AND the
    // caller supplied an OTP, verify it for backwards compatibility.
    // Otherwise (new flow, or no OTP supplied) skip the check entirely.
    if (delivery.otpHash && input.otp) {
      const ok = await bcrypt.compare(input.otp, delivery.otpHash);
      if (!ok) {
        const attempts = delivery.otpAttempts + 1;
        await tx.delivery.update({
          where: { id },
          data: { otpAttempts: attempts },
        });
        throw new ActionError("OTP did not match");
      }
    }

    // Payment-on-delivery: validate the trio before doing any writes.
    let pay: { amount: Decimal; method: PaymentMethod; reference: string | null } | null = null;
    if (input.paymentCollected) {
      if (!input.paymentAmount || !input.paymentMethod) {
        throw new ActionError("Payment amount and method are required when payment is collected");
      }
      const amt = toDecimal(input.paymentAmount);
      if (amt.lte(0)) throw new ActionError("Payment amount must be greater than zero");
      pay = {
        amount: amt,
        method: input.paymentMethod,
        reference: input.paymentReference?.trim() || null,
      };
    }

    // Status guard: a concurrent confirm/fail (double-tap, two devices)
    // loses the race and gets a clear message instead of double-writing.
    const updated = await tx.delivery.updateMany({
      where: { id, status: { notIn: [DeliveryStatus.DELIVERED, DeliveryStatus.FAILED] } },
      data: {
        status: DeliveryStatus.DELIVERED,
        deliveredAt: new Date(),
        paymentCollected: input.paymentCollected ?? false,
        paymentAmount: pay ? pay.amount.toFixed(2) : null,
        paymentMethod: pay ? pay.method : null,
        paymentReference: pay ? pay.reference : null,
        paymentRecordedAt: pay ? new Date() : null,
      },
    });
    if (updated.count === 0) {
      throw new ActionError("This delivery was already confirmed or failed — refresh the page.");
    }
    // Generate a feedback token when the order goes DELIVERED. The
    // public form at /f/<token> opens for ROOM_SERVICE / PACKET / ODC
    // / ALACARTE channels — banquet + management skip it (no public
    // customer to chase). Token is 24 random bytes base64url-encoded.
    // The actual WhatsApp/SMS send happens in a later phase; for now
    // the link is just persisted on the Order row so it's reachable.
    const fullOrder = await tx.order.findUnique({
      where: { id: delivery.orderId },
      select: { channel: true, feedbackToken: true },
    });
    const wantsFeedback =
      fullOrder &&
      !fullOrder.feedbackToken &&
      channelWantsFeedback(fullOrder.channel);
    await tx.order.update({
      where: { id: delivery.orderId },
      data: {
        status: OrderStatus.DELIVERED,
        ...(wantsFeedback
          ? {
              feedbackToken: randomFeedbackToken(),
              feedbackSentAt: new Date(),
            }
          : {}),
      },
    });
    await tx.deliveryAttempt.create({
      data: { deliveryId: id, outcome: "OTP_MATCH" },
    });

    // Payment-on-delivery: still record the cash/UPI the driver collected
    // at the door — but defer binding it to a tax invoice. The accounts /
    // admin / manager generates the invoice manually from the order
    // detail page, and we credit any pending PoD payments against it
    // there. For now stash the amount on the delivery row itself.

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DELIVERY_DELIVERED",
        entity: "Delivery",
        entityId: id,
        payloadHash: pay ? sha256Json({ paymentCollected: true, amount: pay.amount.toFixed(2), method: pay.method }) : undefined,
      },
    });

    return { orderId: delivery.orderId };
  });

  revalidatePath(`/deliveries/${id}`);
  revalidatePath("/deliveries");
  revalidatePath(`/orders/${result.orderId}`);
  return { ok: true };
}

export async function failDelivery(id: string, raw: unknown): Promise<ActionResult> {
  try {
    const session = await requireRole(DRIVER_OR_MANAGER);
    const input = DeliveryFailureInput.parse(raw);
    await db.$transaction(async (tx) => {
      const delivery = await tx.delivery.findUnique({ where: { id }, select: { status: true, driverUserId: true } });
      if (!delivery) throw new ActionError("Delivery not found");
      if (delivery.status === DeliveryStatus.DELIVERED || delivery.status === DeliveryStatus.FAILED) {
        throw new ActionError(`Delivery is already ${delivery.status}`);
      }
      if (session.user.role === Role.DELIVERY && delivery.driverUserId !== session.user.id) {
        throw new ActionError("Drivers can only fail their own deliveries");
      }
      // Status guard: a concurrent confirm/fail loses the race cleanly.
      const updated = await tx.delivery.updateMany({
        where: { id, status: { notIn: [DeliveryStatus.DELIVERED, DeliveryStatus.FAILED] } },
        data: { status: DeliveryStatus.FAILED, failureReason: input.reason },
      });
      if (updated.count === 0) {
        throw new ActionError("This delivery was already confirmed or failed — refresh the page.");
      }
      await tx.deliveryAttempt.create({
        data: { deliveryId: id, outcome: "OTHER", notes: input.reason },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "DELIVERY_FAILED",
          entity: "Delivery",
          entityId: id,
          payloadHash: sha256Json({ reason: input.reason }),
        },
      });
    });
    revalidatePath(`/deliveries/${id}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

// ─── Queries ─────────────────────────────────────────────────────────────

export async function listDeliveries(
  opts: {
    status?: DeliveryStatus[];
    mine?: boolean;
    customerId?: string;
    /** Scheduled-at lower bound (UTC, inclusive). */
    from?: Date;
    /** Scheduled-at upper bound (UTC, inclusive). */
    to?: Date;
  } = {},
) {
  const session = await requireRole(READ_ROLES);
  // DELIVERY role: scope to their own assignments only (privacy req per SECURITY.md §6).
  const scopedMine = opts.mine || session.user.role === Role.DELIVERY;

  return db.delivery.findMany({
    where: {
      ...(opts.status ? { status: { in: opts.status } } : {}),
      ...(scopedMine ? { driverUserId: session.user.id } : {}),
      ...(opts.customerId ? { order: { customerId: opts.customerId } } : {}),
      ...(opts.from || opts.to
        ? {
            scheduledAt: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
    include: {
      order: {
        select: {
          id: true, code: true, deliveryAddress: true, eventDate: true,
          customer: { select: { name: true } },
        },
      },
      driver: { select: { name: true } },
    },
    orderBy: { scheduledAt: "desc" },
    take: 300,
  });
}

/**
 * Distinct customers that appear in the delivery list (scoped to the
 * driver's own when the caller is a DELIVERY). Populates the company
 * filter dropdown on the deliveries page.
 */
export async function listDeliveryCustomers() {
  const session = await requireRole(READ_ROLES);
  const scopedMine = session.user.role === Role.DELIVERY;
  return db.customer.findMany({
    where: {
      orders: {
        some: {
          deliveries: { some: scopedMine ? { driverUserId: session.user.id } : {} },
        },
      },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function getDelivery(id: string) {
  const session = await requireSession();
  const delivery = await db.delivery.findUnique({
    where: { id },
    include: {
      order: {
        select: {
          id: true, code: true, deliveryAddress: true, eventDate: true,
          channel: true, mealType: true, headcount: true, notes: true,
          roomNumber: true, tableNumber: true,
          deliveryWindowStart: true, deliveryWindowEnd: true,
          customer: { select: { name: true, phone: true, contactName: true } },
          items: {
            orderBy: { sortOrder: "asc" },
            select: { portions: true, dish: { select: { name: true, unit: true } } },
          },
        },
      },
      driver: { select: { id: true, name: true } },
      attempts: { orderBy: { attemptedAt: "desc" } },
    },
  });
  if (!delivery) return null;

  // DELIVERY role: only see customer phone if they're the assigned driver.
  // SECURITY.md §6 PII rule.
  if (
    session.user.role === Role.DELIVERY &&
    delivery.driverUserId !== session.user.id
  ) {
    return null;
  }
  // Even for assigned driver, leave phone intact only on their delivery.
  // (Already conditional via the above guard.)
  return delivery;
}

export async function listDrivers() {
  await requireRole([Role.ADMIN, Role.MANAGER]);
  return db.user.findMany({
    where: { active: true, role: { in: [Role.DELIVERY, Role.ADMIN] } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}
