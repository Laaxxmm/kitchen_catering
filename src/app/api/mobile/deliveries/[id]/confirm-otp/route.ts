import bcrypt from "bcryptjs";
import { DeliveryStatus, OrderStatus } from "@prisma/client";
import { db } from "@/server/db";
import { MobileAuthError, mobileError, requireMobileAuth } from "@/server/mobile-auth";
import { sha256Json } from "@/lib/audit";

/**
 * POST /api/mobile/deliveries/:id/confirm-otp
 * Body: { otp: "1234" }
 *
 * Mirrors confirmDeliveryOTP in src/server/actions/deliveries.ts but
 * over bearer-token auth for the native app. Returns the updated
 * status so the client can refresh.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireMobileAuth(req);
    const body = (await req.json()) as { otp?: string };
    const otp = body.otp?.trim();
    if (!otp || !/^[0-9]{4}$/.test(otp)) {
      throw new MobileAuthError(400, "OTP must be 4 digits");
    }

    const result = await db.$transaction(async (tx) => {
      const delivery = await tx.delivery.findUnique({ where: { id } });
      if (!delivery) throw new MobileAuthError(404, "Delivery not found");
      if (delivery.driverUserId !== session.user.id) {
        throw new MobileAuthError(403, "Not your delivery");
      }
      if (delivery.status === DeliveryStatus.DELIVERED || delivery.status === DeliveryStatus.FAILED) {
        throw new MobileAuthError(409, `Already ${delivery.status}`);
      }
      if (!delivery.otpHash) throw new MobileAuthError(500, "Delivery has no OTP set");

      const ok = await bcrypt.compare(otp, delivery.otpHash);
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
        throw new MobileAuthError(401, `Invalid OTP (${3 - attempts} attempts remaining)`);
      }

      await tx.delivery.update({
        where: { id },
        data: { status: DeliveryStatus.DELIVERED, deliveredAt: new Date() },
      });
      await tx.order.update({
        where: { id: delivery.orderId },
        data: { status: OrderStatus.DELIVERED },
      });
      await tx.deliveryAttempt.create({ data: { deliveryId: id, outcome: "OTP_MATCH" } });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "DELIVERY_DELIVERED",
          entity: "Delivery",
          entityId: id,
        },
      });
      return { status: DeliveryStatus.DELIVERED };
    });
    return Response.json(result);
  } catch (err) {
    return mobileError(err);
  }
}
