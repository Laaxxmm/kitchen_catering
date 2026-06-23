"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { DeliveryStatus, OrderStatus, PaymentMethod, Role } from "@prisma/client";
import { Decimal } from "decimal.js";
import { db } from "@/server/db";
import { toDecimal } from "@/lib/money";
import {
  AuthorizationError,
  requireRole,
  requireSession,
} from "@/server/rbac";
import {
  DeliveryAssignInput,
  DeliveryFailureInput,
  DeliveryOTPInput,
} from "@/lib/validators";
import { nextDeliveryNumber } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { notifyRoles } from "@/server/actions/notifications";

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
export async function handToDelivery(orderId: string) {
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
  if (!order) throw new Error("Order not found");
  if (order.status !== OrderStatus.READY) {
    throw new AuthorizationError(
      `Order ${order.code} isn't ready to dispatch yet (it's ${order.status}).`,
    );
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
  await notifyRoles([Role.DELIVERY, Role.ADMIN, Role.MANAGER], {
    kind: "GENERIC",
    title: `Order ${order.code} ready to dispatch`,
    body: `${order.customer.name} · ${order.channel}${where}. Cooked and ready — schedule the delivery.`,
    link: `/deliveries/new?orderId=${orderId}`,
    dedupeKey: `order-ready-dispatch:${orderId}`,
  });
  revalidatePath("/dashboard");
  revalidatePath("/deliveries");
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
      eventDate: true,
      roomNumber: true,
      deliveryAddress: true,
      customer: { select: { name: true } },
    },
    orderBy: { eventDate: "asc" },
    take: 50,
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
export async function claimDelivery(orderId: string) {
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
    if (!order) throw new Error("Order not found");
    if (order.status !== OrderStatus.READY) {
      throw new AuthorizationError(
        `Order ${order.code} isn't ready for pickup yet (it's ${order.status}).`,
      );
    }
    const existing = await tx.delivery.findFirst({
      where: { orderId, status: { notIn: [DeliveryStatus.FAILED, DeliveryStatus.CANCELLED] } },
      select: { id: true },
    });
    if (existing) throw new Error("This order has already been picked up.");

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
  return { id: created.id, deliveryNo: created.deliveryNo };
}

export async function scheduleDelivery(raw: unknown) {
  const session = await requireRole(SCHEDULE_ROLES);
  const input = DeliveryAssignInput.parse(raw);

  const result = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: { id: true, code: true, status: true, deliveryAddress: true, customer: { select: { contactName: true, phone: true } } },
    });
    if (!order) throw new Error("Order not found");
    if (order.status !== OrderStatus.READY) {
      throw new AuthorizationError(`Cannot schedule delivery for order in status ${order.status}`);
    }

    const deliveryNo = await nextDeliveryNumber(tx);

    const delivery = await tx.delivery.create({
      data: {
        deliveryNo,
        orderId: order.id,
        driverUserId: input.driverUserId,
        vehicleNo: input.vehicleNo ?? null,
        scheduledAt: new Date(input.scheduledAt),
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
  return { id: result.delivery.id, deliveryNo: result.delivery.deliveryNo };
}

export async function dispatchDelivery(id: string) {
  const session = await requireRole(DRIVER_OR_MANAGER);
  await db.$transaction(async (tx) => {
    const delivery = await tx.delivery.findUnique({
      where: { id },
      select: { status: true, driverUserId: true, orderId: true },
    });
    if (!delivery) throw new Error("Delivery not found");
    if (delivery.status !== DeliveryStatus.SCHEDULED) {
      throw new AuthorizationError(`Cannot dispatch a delivery in status ${delivery.status}`);
    }
    // Driver can only dispatch their own.
    if (
      session.user.role === Role.DELIVERY &&
      delivery.driverUserId !== session.user.id
    ) {
      throw new AuthorizationError("Drivers can only dispatch their own deliveries");
    }
    await tx.delivery.update({
      where: { id },
      data: { status: DeliveryStatus.DISPATCHED, dispatchedAt: new Date() },
    });
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
}

export async function markDeliveryArrived(id: string) {
  const session = await requireRole(DRIVER_OR_MANAGER);
  await db.$transaction(async (tx) => {
    const delivery = await tx.delivery.findUnique({
      where: { id },
      select: { status: true, driverUserId: true },
    });
    if (!delivery) throw new Error("Delivery not found");
    if (
      delivery.status !== DeliveryStatus.DISPATCHED &&
      delivery.status !== DeliveryStatus.IN_TRANSIT
    ) {
      throw new AuthorizationError(`Cannot mark arrived from ${delivery.status}`);
    }
    if (session.user.role === Role.DELIVERY && delivery.driverUserId !== session.user.id) {
      throw new AuthorizationError("Drivers can only update their own deliveries");
    }
    await tx.delivery.update({ where: { id }, data: { arrivedAt: new Date() } });
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
export async function confirmDeliveryOTP(id: string, raw: unknown) {
  const session = await requireRole(DRIVER_OR_MANAGER);
  const input = DeliveryOTPInput.parse(raw);

  const result = await db.$transaction(async (tx) => {
    const delivery = await tx.delivery.findUnique({ where: { id } });
    if (!delivery) throw new Error("Delivery not found");
    if (delivery.status === DeliveryStatus.DELIVERED || delivery.status === DeliveryStatus.FAILED) {
      throw new AuthorizationError(`Delivery is already ${delivery.status}`);
    }
    if (session.user.role === Role.DELIVERY && delivery.driverUserId !== session.user.id) {
      throw new AuthorizationError("Drivers can only confirm their own deliveries");
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
        throw new Error("OTP did not match");
      }
    }

    // Payment-on-delivery: validate the trio before doing any writes.
    let pay: { amount: Decimal; method: PaymentMethod; reference: string | null } | null = null;
    if (input.paymentCollected) {
      if (!input.paymentAmount || !input.paymentMethod) {
        throw new Error("Payment amount and method are required when payment is collected");
      }
      const amt = toDecimal(input.paymentAmount);
      if (amt.lte(0)) throw new Error("Payment amount must be greater than zero");
      pay = {
        amount: amt,
        method: input.paymentMethod,
        reference: input.paymentReference?.trim() || null,
      };
    }

    await tx.delivery.update({
      where: { id },
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
      (fullOrder.channel === "ROOM_SERVICE" ||
        fullOrder.channel === "PACKET" ||
        fullOrder.channel === "ODC" ||
        fullOrder.channel === "ALACARTE");
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
}

export async function failDelivery(id: string, raw: unknown) {
  const session = await requireRole(DRIVER_OR_MANAGER);
  const input = DeliveryFailureInput.parse(raw);
  await db.$transaction(async (tx) => {
    const delivery = await tx.delivery.findUnique({ where: { id }, select: { status: true, driverUserId: true } });
    if (!delivery) throw new Error("Delivery not found");
    if (delivery.status === DeliveryStatus.DELIVERED || delivery.status === DeliveryStatus.FAILED) {
      throw new AuthorizationError(`Delivery is already ${delivery.status}`);
    }
    if (session.user.role === Role.DELIVERY && delivery.driverUserId !== session.user.id) {
      throw new AuthorizationError("Drivers can only fail their own deliveries");
    }
    await tx.delivery.update({
      where: { id },
      data: { status: DeliveryStatus.FAILED, failureReason: input.reason },
    });
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
}

// ─── Queries ─────────────────────────────────────────────────────────────

export async function listDeliveries(opts: { status?: DeliveryStatus[]; mine?: boolean } = {}) {
  const session = await requireRole(READ_ROLES);
  // DELIVERY role: scope to their own assignments only (privacy req per SECURITY.md §6).
  const scopedMine = opts.mine || session.user.role === Role.DELIVERY;

  return db.delivery.findMany({
    where: {
      ...(opts.status ? { status: { in: opts.status } } : {}),
      ...(scopedMine ? { driverUserId: session.user.id } : {}),
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
    orderBy: { scheduledAt: "asc" },
    take: 200,
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
          customer: { select: { name: true, phone: true, contactName: true } },
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
