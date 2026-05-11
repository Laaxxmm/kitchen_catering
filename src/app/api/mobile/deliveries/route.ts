import { DeliveryStatus } from "@prisma/client";
import { db } from "@/server/db";
import { mobileError, requireMobileAuth } from "@/server/mobile-auth";

/**
 * GET /api/mobile/deliveries
 * Returns active deliveries assigned to the bearer-token user.
 * DELIVERY role only sees their own (enforced here by scoping
 * driverUserId to session.user.id).
 */
export async function GET(req: Request) {
  try {
    const session = await requireMobileAuth(req);
    const deliveries = await db.delivery.findMany({
      where: {
        driverUserId: session.user.id,
        status: { in: [DeliveryStatus.SCHEDULED, DeliveryStatus.DISPATCHED, DeliveryStatus.IN_TRANSIT] },
      },
      include: {
        order: {
          select: {
            code: true,
            deliveryAddress: true,
            customer: { select: { name: true } },
          },
        },
      },
      orderBy: { scheduledAt: "asc" },
      take: 50,
    });
    return Response.json({
      deliveries: deliveries.map((d) => ({
        id: d.id,
        deliveryNo: d.deliveryNo,
        status: d.status,
        scheduledAt: d.scheduledAt.toISOString(),
        orderCode: d.order.code,
        customerName: d.order.customer.name,
        deliveryAddress: d.order.deliveryAddress,
        recipientPhone: d.recipientPhone,
        otpAttempts: d.otpAttempts,
      })),
    });
  } catch (err) {
    return mobileError(err);
  }
}
