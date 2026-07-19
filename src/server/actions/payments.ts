"use server";

import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import {
  CustomerInvoiceStatus,
  OrderStatus,
  PaymentMethod,
  Role,
  VendorBillStatus,
} from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import {
  ActionError,
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";
import {
  CustomerInvoicePaymentInput,
  PaymentReversalInput,
  VendorBillPaymentInput,
} from "@/lib/validators";
import { sha256Json } from "@/lib/audit";
import { toDecimal } from "@/lib/money";

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS];

function methodCanonical(m: string | PaymentMethod): PaymentMethod {
  return m as PaymentMethod;
}

/**
 * Record a payment against an ISSUED invoice. Recomputes amountPaid as the
 * sum of non-reversed payments and flips invoice.status:
 *   amountPaid == 0           -> ISSUED       (no change)
 *   0 < amountPaid < total    -> PARTIAL
 *   amountPaid >= total       -> PAID
 * If the invoice flips to PAID and is tied to an Order, the order also
 * flips to PAID.
 */
export async function recordCustomerInvoicePayment(
  raw: unknown,
): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await recordCustomerInvoicePaymentInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function recordCustomerInvoicePaymentInner(raw: unknown): Promise<{ ok: true; id: string }> {
  const session = await requireRole(WRITE_ROLES);
  const input = CustomerInvoicePaymentInput.parse(raw);
  if (toDecimal(input.amount).lte(0)) throw new ActionError("Amount must be positive");

  const result = await db.$transaction(async (tx) => {
    const invoice = await tx.customerInvoice.findUnique({
      where: { id: input.invoiceId },
      select: {
        id: true, status: true, grandTotal: true, orderId: true,
        onHoldAt: true, onHoldReason: true,
      },
    });
    if (!invoice) throw new ActionError("Invoice not found");
    // Billing hold — wrong address / wrong client / wrong items / payment
    // dispute. No payments can land until accounts releases the hold.
    if (invoice.onHoldAt) {
      throw new ActionError(
        `Invoice is on hold: ${invoice.onHoldReason ?? "no reason recorded"} — release the hold first`,
      );
    }
    if (
      invoice.status !== CustomerInvoiceStatus.ISSUED &&
      invoice.status !== CustomerInvoiceStatus.PARTIAL
    ) {
      throw new ActionError(`Cannot record payment on invoice in status ${invoice.status}`);
    }

    // Guardrail: block over-recording. If this payment would push total
    // recorded above the invoice grand total, stop — it's almost always a
    // duplicate entry (seen live: one invoice recorded three times).
    const priorRows = await tx.customerInvoicePayment.findMany({
      where: { invoiceId: invoice.id, reversedAt: null },
      select: { amount: true },
    });
    const priorPaid = priorRows.reduce((s, r) => s.plus(toDecimal(r.amount)), new Decimal(0));
    const grandTotal = toDecimal(invoice.grandTotal);
    const wouldBe = priorPaid.plus(toDecimal(input.amount));
    if (wouldBe.gt(grandTotal)) {
      throw new ActionError(
        `Recorded payments would be ₹${wouldBe.toFixed(2)} on a ₹${grandTotal.toFixed(2)} invoice ` +
          `(₹${priorPaid.toFixed(2)} already recorded). Check for a duplicate payment.`,
      );
    }

    const payment = await tx.customerInvoicePayment.create({
      data: {
        invoiceId: invoice.id,
        amount: input.amount,
        paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
        method: methodCanonical(input.method),
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        recordedById: session.user.id,
      },
    });

    // Recompute amountPaid
    const liveRows = await tx.customerInvoicePayment.findMany({
      where: { invoiceId: invoice.id, reversedAt: null },
      select: { amount: true },
    });
    const paid = liveRows.reduce((s, r) => s.plus(new Decimal(r.amount.toString())), new Decimal(0));
    const grand = new Decimal(invoice.grandTotal.toString());
    const fullyPaid = paid.gte(grand);
    const partial = paid.gt(0) && !fullyPaid;

    await tx.customerInvoice.update({
      where: { id: invoice.id },
      data: {
        amountPaid: paid.toDecimalPlaces(2).toString(),
        paidAt: fullyPaid ? new Date() : null,
        status: fullyPaid
          ? CustomerInvoiceStatus.PAID
          : partial
            ? CustomerInvoiceStatus.PARTIAL
            : CustomerInvoiceStatus.ISSUED,
      },
    });

    if (fullyPaid && invoice.orderId) {
      // Invoice fully settled → the order is done. COMPLETED is the terminal
      // state; PAID is a legacy resting point handled by the manual "Close
      // order" button for orders settled before this flip existed.
      await tx.order.update({
        where: { id: invoice.orderId },
        data: { status: OrderStatus.COMPLETED },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CUSTOMER_INVOICE_PAYMENT_RECORDED",
        entity: "CustomerInvoicePayment",
        entityId: payment.id,
        payloadHash: sha256Json({ invoiceId: invoice.id, amount: input.amount, method: input.method }),
      },
    });

    return payment;
  });

  revalidatePath(`/invoices/${input.invoiceId}`);
  revalidatePath("/payments/receivables");
  return { ok: true, id: result.id };
}

export async function reverseCustomerInvoicePayment(raw: unknown): Promise<ActionResult> {
  try {
    return await reverseCustomerInvoicePaymentInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function reverseCustomerInvoicePaymentInner(raw: unknown): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  const input = PaymentReversalInput.parse(raw);

  await db.$transaction(async (tx) => {
    const payment = await tx.customerInvoicePayment.findUnique({
      where: { id: input.paymentId },
      select: { id: true, invoiceId: true, reversedAt: true },
    });
    if (!payment) throw new ActionError("Payment not found");
    if (payment.reversedAt) throw new ActionError("Payment is already reversed");

    await tx.customerInvoicePayment.update({
      where: { id: payment.id },
      data: {
        reversedAt: new Date(),
        reversedReason: input.reason,
        reversedById: session.user.id,
      },
    });

    // Recompute parent invoice.amountPaid + status.
    const invoice = await tx.customerInvoice.findUnique({
      where: { id: payment.invoiceId },
      select: { id: true, grandTotal: true, orderId: true },
    });
    if (!invoice) throw new ActionError("Parent invoice missing");
    const liveRows = await tx.customerInvoicePayment.findMany({
      where: { invoiceId: invoice.id, reversedAt: null },
      select: { amount: true },
    });
    const paid = liveRows.reduce((s, r) => s.plus(new Decimal(r.amount.toString())), new Decimal(0));
    const grand = new Decimal(invoice.grandTotal.toString());
    const fullyPaid = paid.gte(grand);
    const partial = paid.gt(0) && !fullyPaid;

    await tx.customerInvoice.update({
      where: { id: invoice.id },
      data: {
        amountPaid: paid.toDecimalPlaces(2).toString(),
        paidAt: fullyPaid ? new Date() : null,
        status: fullyPaid
          ? CustomerInvoiceStatus.PAID
          : partial
            ? CustomerInvoiceStatus.PARTIAL
            : CustomerInvoiceStatus.ISSUED,
      },
    });

    // If the order had auto-flipped to PAID/COMPLETED on full settlement,
    // demote it back to INVOICED now that a payment has been pulled.
    if (invoice.orderId && !fullyPaid) {
      const orderNow = await tx.order.findUnique({
        where: { id: invoice.orderId },
        select: { status: true },
      });
      if (
        orderNow?.status === OrderStatus.PAID ||
        orderNow?.status === OrderStatus.COMPLETED
      ) {
        await tx.order.update({
          where: { id: invoice.orderId },
          data: { status: OrderStatus.INVOICED },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CUSTOMER_INVOICE_PAYMENT_REVERSED",
        entity: "CustomerInvoicePayment",
        entityId: payment.id,
        payloadHash: sha256Json({ reason: input.reason }),
      },
    });
  });

  revalidatePath("/payments/receivables");
  return { ok: true };
}

export async function listReceivablePayments(limit = 100) {
  await requireRole([...WRITE_ROLES, Role.SALES]);
  return db.customerInvoicePayment.findMany({
    orderBy: { paidAt: "desc" },
    take: limit,
    include: {
      invoice: { select: { invoiceNo: true, customerId: true, customer: { select: { name: true } } } },
      recordedBy: { select: { name: true } },
    },
  });
}

// =====================================================================
// VENDOR BILL PAYMENTS (AP) — Phase 2 wires this up
// =====================================================================

export async function recordVendorBillPayment(
  raw: unknown,
): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await recordVendorBillPaymentInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function recordVendorBillPaymentInner(raw: unknown): Promise<{ ok: true; id: string }> {
  const session = await requireRole(WRITE_ROLES);
  const input = VendorBillPaymentInput.parse(raw);
  if (toDecimal(input.amount).lte(0)) throw new ActionError("Amount must be positive");

  const result = await db.$transaction(async (tx) => {
    const bill = await tx.vendorBill.findUnique({
      where: { id: input.billId },
      select: { id: true, status: true, grandTotal: true },
    });
    if (!bill) throw new ActionError("Bill not found");
    if (bill.status !== VendorBillStatus.APPROVED && bill.status !== VendorBillStatus.MATCHED) {
      throw new ActionError(`Cannot pay a bill in status ${bill.status}`);
    }
    const payment = await tx.vendorBillPayment.create({
      data: {
        vendorBillId: bill.id,
        amount: input.amount,
        paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
        method: methodCanonical(input.method),
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        recordedById: session.user.id,
      },
    });
    const liveRows = await tx.vendorBillPayment.findMany({
      where: { vendorBillId: bill.id, reversedAt: null },
      select: { amount: true },
    });
    const paid = liveRows.reduce((s, r) => s.plus(new Decimal(r.amount.toString())), new Decimal(0));
    const grand = new Decimal(bill.grandTotal.toString());
    const fullyPaid = paid.gte(grand);

    await tx.vendorBill.update({
      where: { id: bill.id },
      data: {
        amountPaid: paid.toDecimalPlaces(2).toString(),
        paidAt: fullyPaid ? new Date() : null,
        status: fullyPaid ? VendorBillStatus.PAID : VendorBillStatus.APPROVED,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "VENDOR_BILL_PAYMENT_RECORDED",
        entity: "VendorBillPayment",
        entityId: payment.id,
        payloadHash: sha256Json({ billId: bill.id, amount: input.amount }),
      },
    });
    return payment;
  });

  revalidatePath(`/procurement/vendor-bills/${input.billId}`);
  revalidatePath("/payments/payables");
  return { ok: true, id: result.id };
}

export async function reverseVendorBillPayment(raw: unknown): Promise<ActionResult> {
  try {
    return await reverseVendorBillPaymentInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function reverseVendorBillPaymentInner(raw: unknown): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  const input = PaymentReversalInput.parse(raw);

  await db.$transaction(async (tx) => {
    const payment = await tx.vendorBillPayment.findUnique({
      where: { id: input.paymentId },
      select: { id: true, vendorBillId: true, reversedAt: true },
    });
    if (!payment) throw new ActionError("Payment not found");
    if (payment.reversedAt) throw new ActionError("Payment already reversed");
    await tx.vendorBillPayment.update({
      where: { id: payment.id },
      data: {
        reversedAt: new Date(),
        reversedReason: input.reason,
        reversedById: session.user.id,
      },
    });
    const bill = await tx.vendorBill.findUnique({
      where: { id: payment.vendorBillId },
      select: { id: true, grandTotal: true },
    });
    if (!bill) throw new ActionError("Parent bill missing");
    const liveRows = await tx.vendorBillPayment.findMany({
      where: { vendorBillId: bill.id, reversedAt: null },
      select: { amount: true },
    });
    const paid = liveRows.reduce((s, r) => s.plus(new Decimal(r.amount.toString())), new Decimal(0));
    const grand = new Decimal(bill.grandTotal.toString());
    const fullyPaid = paid.gte(grand);
    await tx.vendorBill.update({
      where: { id: bill.id },
      data: {
        amountPaid: paid.toDecimalPlaces(2).toString(),
        paidAt: fullyPaid ? new Date() : null,
        status: fullyPaid ? VendorBillStatus.PAID : VendorBillStatus.APPROVED,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "VENDOR_BILL_PAYMENT_REVERSED",
        entity: "VendorBillPayment",
        entityId: payment.id,
        payloadHash: sha256Json({ reason: input.reason }),
      },
    });
  });
  revalidatePath("/payments/payables");
  return { ok: true };
}

export async function listPayablePayments(limit = 100) {
  await requireRole(WRITE_ROLES);
  return db.vendorBillPayment.findMany({
    where: { reversedAt: null },
    orderBy: { paidAt: "desc" },
    take: limit,
    include: {
      vendorBill: { select: { id: true, billNo: true, vendor: { select: { name: true } } } },
      recordedBy: { select: { name: true } },
    },
  });
}
