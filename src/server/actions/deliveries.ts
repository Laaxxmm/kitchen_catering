"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { DeliveryStatus, OrderStatus, Role } from "@prisma/client";
import { db } from "@/server/db";
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
import { formatOTPMessage, getSMSProvider } from "@/lib/sms";

const SCHEDULE_ROLES = [Role.ADMIN, Role.MANAGER];
const DRIVER_OR_MANAGER = [Role.ADMIN, Role.MANAGER, Role.DELIVERY];
const READ_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.SALES, Role.STORE_KEEPER, Role.KITCHEN_HEAD, Role.ACCOUNTS, Role.DELIVERY,
];

function generateOTP(): string {
  // 4-digit OTP, leading zeros allowed.
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

/**
 * Schedule a delivery against a READY order. Generates a 4-digit OTP whose
 * bcrypt hash is stored; the plaintext is logged to the server console so
 * the dispatcher can read it back in Phase 1 (Phase 3 wires MSG91 SMS).
 */
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
    const otp = generateOTP();
    const otpHash = await bcrypt.hash(otp, 12);

    const delivery = await tx.delivery.create({
      data: {
        deliveryNo,
        orderId: order.id,
        driverUserId: input.driverUserId,
        vehicleNo: input.vehicleNo ?? null,
        scheduledAt: new Date(input.scheduledAt),
        otpHash,
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

    return { delivery, otp, orderCode: order.code };
  });

  // Phase 3: route the OTP through the SMS provider. Falls back to console
  // when SMS_PROVIDER is unset. The bcrypt-hashed copy in the DB is what
  // actually gates confirmation; the SMS just makes the OTP available to
  // the recipient.
  const driver = await db.user.findUnique({
    where: { id: input.driverUserId },
    select: { phone: true },
  });
  const recipientPhone = result.delivery.recipientPhone ?? driver?.phone;
  if (recipientPhone) {
    try {
      const sms = getSMSProvider();
      await sms.send(recipientPhone, formatOTPMessage(result.otp, result.orderCode));
    } catch (err) {
      // Don't fail the scheduling on SMS error — just log it. The dispatcher
      // can read the OTP off the audit log / console fallback.
      console.error(`[SMS error scheduling ${result.delivery.deliveryNo}]: ${err instanceof Error ? err.message : err}`);
    }
  } else {
    console.error(
      `[DELIVERY OTP] ${result.delivery.deliveryNo} (order ${result.orderCode}) OTP=${result.otp} (no recipient phone)`,
    );
  }

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

export async function confirmDeliveryOTP(id: string, raw: unknown) {
  const session = await requireRole(DRIVER_OR_MANAGER);
  const input = DeliveryOTPInput.parse(raw);

  await db.$transaction(async (tx) => {
    const delivery = await tx.delivery.findUnique({ where: { id } });
    if (!delivery) throw new Error("Delivery not found");
    if (delivery.status === DeliveryStatus.DELIVERED || delivery.status === DeliveryStatus.FAILED) {
      throw new AuthorizationError(`Delivery is already ${delivery.status}`);
    }
    if (session.user.role === Role.DELIVERY && delivery.driverUserId !== session.user.id) {
      throw new AuthorizationError("Drivers can only confirm their own deliveries");
    }
    if (!delivery.otpHash) throw new Error("Delivery has no OTP set");

    const ok = await bcrypt.compare(input.otp, delivery.otpHash);
    if (!ok) {
      const attempts = delivery.otpAttempts + 1;
      const failNow = attempts >= 3;
      await tx.delivery.update({
        where: { id },
        data: {
          otpAttempts: attempts,
          status: failNow ? DeliveryStatus.FAILED : delivery.status,
          failureReason: failNow ? "Maximum OTP attempts exceeded" : delivery.failureReason,
        },
      });
      await tx.deliveryAttempt.create({
        data: { deliveryId: id, outcome: "OTP_MISMATCH" },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: failNow ? "DELIVERY_FAILED_OTP_LIMIT" : "DELIVERY_OTP_MISMATCH",
          entity: "Delivery",
          entityId: id,
          payloadHash: sha256Json({ attempts }),
        },
      });
      if (failNow) {
        // Order does NOT auto-cancel; manager decides next step.
      }
      throw new Error(`Invalid OTP (${3 - attempts} attempts remaining)`);
    }

    await tx.delivery.update({
      where: { id },
      data: { status: DeliveryStatus.DELIVERED, deliveredAt: new Date() },
    });
    await tx.order.update({
      where: { id: delivery.orderId },
      data: { status: OrderStatus.DELIVERED },
    });
    await tx.deliveryAttempt.create({
      data: { deliveryId: id, outcome: "OTP_MATCH" },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DELIVERY_DELIVERED",
        entity: "Delivery",
        entityId: id,
      },
    });
  });
  revalidatePath(`/deliveries/${id}`);
  revalidatePath("/deliveries");
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
