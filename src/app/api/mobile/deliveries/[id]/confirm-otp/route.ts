import bcrypt from "bcryptjs";
import { DeliveryStatus, OrderStatus } from "@prisma/client";
import { db } from "@/server/db";
import { MobileAuthError, mobileError, requireMobileAuth } from "@/server/mobile-auth";
import { sha256Json } from "@/lib/audit";
import { createTaxInvoiceForOrderInTx } from "@/server/actions/customer-invoices";
import { emailTaxInvoiceCore } from "@/server/customer-invoices-core";

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

    // OTP verification happens OUTSIDE the transaction: the failed-attempt
    // increment must persist, and inside the tx the thrown error would roll
    // it straight back (making the counter — and any cap on it — useless).
    const delivery = await db.delivery.findUnique({ where: { id } });
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
      // A 4-digit OTP has only 10,000 combinations — without an attempt
      // cap it can be brute-forced in seconds.
      if (delivery.otpAttempts >= 5) {
        throw new MobileAuthError(429, "Too many OTP attempts — ask the office to re-verify this delivery");
      }
      const ok = await bcrypt.compare(otp, delivery.otpHash);
      if (!ok) {
        await db.delivery.update({
          where: { id },
          data: { otpAttempts: { increment: 1 } },
        });
        throw new MobileAuthError(401, "OTP did not match");
      }
    }

    const result = await db.$transaction(async (tx) => {
      // Status guard: a double-tap (or two devices) can't confirm twice —
      // the loser matches zero rows and gets a clean 409.
      const updated = await tx.delivery.updateMany({
        where: { id, status: { notIn: [DeliveryStatus.DELIVERED, DeliveryStatus.FAILED] } },
        data: { status: DeliveryStatus.DELIVERED, deliveredAt: new Date() },
      });
      if (updated.count === 0) {
        throw new MobileAuthError(409, "Already confirmed");
      }
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
      void emailTaxInvoiceCore(result.invoiceId);
    }
    return Response.json({ status: result.status });
  } catch (err) {
    return mobileError(err);
  }
}
