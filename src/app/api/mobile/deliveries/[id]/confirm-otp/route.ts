import bcrypt from "bcryptjs";
import { DeliveryStatus, OrderStatus } from "@prisma/client";
import { db } from "@/server/db";
import { MobileAuthError, mobileError, requireMobileAuth } from "@/server/mobile-auth";
import { sha256Json } from "@/lib/audit";
import {
  createTaxInvoiceForOrderInTx,
  emailTaxInvoice,
} from "@/server/actions/customer-invoices";

/**
 * POST /api/mobile/deliveries/:id/confirm-otp
 * Body: { otp?: "1234" }  // OTP is optional (legacy support only)
 *
 * Mobile counterpart to the web `confirmDeliveryOTP` action. The OTP
 * readback step has been retired — the driver confirms delivery
 * directly. We still accept an OTP for any legacy mobile builds in the
 * wild, and validate it against the bcrypt hash if the delivery row has
 * one set.
 *
 * On confirmation the tax invoice is auto-generated, the order moves to
 * INVOICED, and the customer gets an emailed copy (best-effort).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireMobileAuth(req);
    const body = (await req.json()) as { otp?: string };
    const otp = body.otp?.trim();

    const result = await db.$transaction(async (tx) => {
      const delivery = await tx.delivery.findUnique({ where: { id } });
      if (!delivery) throw new MobileAuthError(404, "Delivery not found");
      if (delivery.driverUserId !== session.user.id) {
        throw new MobileAuthError(403, "Not your delivery");
      }
      if (delivery.status === DeliveryStatus.DELIVERED || delivery.status === DeliveryStatus.FAILED) {
        throw new MobileAuthError(409, `Already ${delivery.status}`);
      }

      // Legacy OTP path: if the delivery has a stored hash AND the
      // caller actually sent an OTP, verify it. Otherwise skip.
      if (delivery.otpHash && otp) {
        if (!/^[0-9]{4}$/.test(otp)) {
          throw new MobileAuthError(400, "OTP must be 4 digits");
        }
        const ok = await bcrypt.compare(otp, delivery.otpHash);
        if (!ok) {
          await tx.delivery.update({
            where: { id },
            data: { otpAttempts: delivery.otpAttempts + 1 },
          });
          throw new MobileAuthError(401, "OTP did not match");
        }
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

      // Auto-create the GST tax invoice + advance order → INVOICED.
      const invoice = await createTaxInvoiceForOrderInTx(tx, delivery.orderId, session.user.id);

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "DELIVERY_DELIVERED",
          entity: "Delivery",
          entityId: id,
          payloadHash: sha256Json({ source: "mobile", invoiceId: invoice.id }),
        },
      });
      return { status: DeliveryStatus.DELIVERED, invoiceId: invoice.id, invoiceCreated: invoice.created };
    });

    // Post-commit email — best-effort.
    if (result.invoiceCreated) {
      void emailTaxInvoice(result.invoiceId);
    }
    return Response.json({ status: result.status });
  } catch (err) {
    return mobileError(err);
  }
}
